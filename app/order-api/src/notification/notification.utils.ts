import { Inject, Injectable, Logger } from '@nestjs/common';
import { RoleEnum } from 'src/role/role.enum';
import {
  NotificationMessageCode,
  NotificationType,
} from './notification.constants';
import { NotificationProducer } from './notification.producer';
import { User } from 'src/user/user.entity';
import { In, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Order } from 'src/order/order.entity';
import { UserException } from 'src/user/user.exception';
import { UserValidation } from 'src/user/user.validation';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { NotificationException } from './notification.exception';
import { NotificationValidation } from './notification.validation';
import { isDefinedCustomer } from 'src/auth/auth.utils';
import { NotificationLanguageService } from './language/notification-language.service';
import { SystemConfigService } from 'src/system-config/system-config.service';
import { SystemConfigKey } from 'src/system-config/system-config.constant';
import { SystemConfigValidation } from 'src/system-config/system-config.validation';
import { CardOrder } from 'src/gift-card-modules/card-order/entities/card-order.entity';
import { Voucher } from 'src/voucher/entity/voucher.entity';

@Injectable()
export class NotificationUtils {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly notificationProducer: NotificationProducer,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: Logger,
    private readonly notificationLanguageService: NotificationLanguageService,
    private readonly systemConfigService: SystemConfigService,
  ) {}

  /**
   * Get the frontend URL
   * @returns {Promise<string>} The frontend URL
   */
  async getFrontendUrl(): Promise<string> {
    const context = `${NotificationUtils.name}.${this.getFrontendUrl.name}`;
    const frontEndUrl = await this.systemConfigService.get(
      SystemConfigKey.FRONTEND_URL,
    );
    if (!frontEndUrl) {
      this.logger.error(
        SystemConfigValidation.SYSTEM_CONFIG_NOT_FOUND,
        context,
      );
      return '';
    }
    return frontEndUrl;
  }

  async sendNotificationAfterOrderIsPaid(order: Order) {
    // Get all chef role users in the same branch
    const chefRoleUsers = await this.userRepository.find({
      where: {
        role: {
          name: RoleEnum.Chef,
        },
        branch: {
          id: order.branch.id,
        },
      },
    });

    const notificationData = chefRoleUsers.map((user) => ({
      message: NotificationMessageCode.ORDER_NEEDS_PROCESSED,
      receiverId: user.id,
      receiverName: `${user.firstName} ${user.lastName}`,
      type: NotificationType.ORDER,
      metadata: {
        order: order.slug,
        orderType: order.type,
        tableName: order.table?.name,
        table: order.table?.slug,
        branchName: order.branch?.name,
        branch: order.branch?.slug,
        referenceNumber: order.referenceNumber.toString(),
        createdAt: order.createdAt.toISOString(),
      },
    }));

    notificationData.push({
      message: NotificationMessageCode.ORDER_PAID,
      receiverId: order.owner.id,
      receiverName: `${order.owner.firstName} ${order.owner.lastName}`,
      type: NotificationType.ORDER,
      metadata: {
        order: order.slug,
        orderType: order.type,
        tableName: order.table?.name,
        table: order.table?.slug,
        branchName: order.branch?.name,
        branch: order.branch?.slug,
        referenceNumber: order.referenceNumber.toString(),
        createdAt: order.createdAt.toISOString(),
      },
    });

    // Send notification to all chef role users in the same branch
    await this.notificationProducer.bulkCreateNotification(notificationData);
  }

  async sendNotificationAfterOrderIsProcessed(order: Order) {
    // Create notification to send to staffs in the same branch
    const staffs = await this.userRepository.find({
      where: {
        role: {
          name: RoleEnum.Staff,
        },
        branch: {
          id: order.branch?.id,
        },
      },
    });

    const notificationData = staffs.map((staff) => ({
      message: NotificationMessageCode.ORDER_NEEDS_DELIVERED,
      receiverId: staff.id,
      type: NotificationType.ORDER,
      receiverName: `${staff.firstName} ${staff.lastName}`,
      metadata: {
        order: order?.slug,
        orderType: order?.type,
        tableName: order?.table?.name,
        table: order?.table?.slug,
        branchName: order?.branch?.name,
        branch: order?.branch?.slug,
        referenceNumber: order.referenceNumber.toString(),
        createdAt: order.createdAt.toISOString(),
      },
    }));

    await this.notificationProducer.bulkCreateNotification(notificationData);
  }

  async sendNotificationForCustomerToGetOrder(
    createdById: string,
    order: Order,
  ) {
    const context = `${NotificationUtils.name}.${this.sendNotificationForCustomerToGetOrder.name}`;
    // Create notification to send to staffs in the same branch
    const customer = await this.userRepository.findOne({
      where: {
        id: order.owner.id,
      },
      relations: { role: true },
    });

    if (!customer) {
      this.logger.error(UserValidation.USER_NOT_FOUND, context);
      throw new UserException(UserValidation.USER_NOT_FOUND);
    }

    if (!isDefinedCustomer(customer)) {
      this.logger.error(NotificationValidation.RECEIVER_NOT_FOUND, context);
      throw new NotificationException(
        NotificationValidation.RECEIVER_NOT_FOUND,
      );
    }

    const sender = await this.userRepository.findOne({
      where: { id: createdById },
    });

    if (!sender) {
      this.logger.error(NotificationValidation.SENDER_NOT_FOUND);
      throw new NotificationException(NotificationValidation.SENDER_NOT_FOUND);
    }

    const notificationMessage = this.notificationLanguageService.format(
      NotificationMessageCode.ORDER_NEEDS_READY_TO_GET,
      { referenceNumber: order.referenceNumber.toString() },
      customer.language as string,
    );

    const frontEndUrl = await this.getFrontendUrl();

    const notificationData = {
      message: NotificationMessageCode.ORDER_NEEDS_READY_TO_GET,
      receiverId: customer.id,
      type: NotificationType.ORDER,
      receiverName: `${customer.firstName} ${customer.lastName}`,
      senderId: sender.id,
      senderName: `${sender.firstName} ${sender.lastName}`,
      title: notificationMessage.title,
      body: notificationMessage.body,
      language: customer.language,
      link: `${frontEndUrl}/history?order=${order.slug}`,
      metadata: {
        order: order.slug,
        orderType: order.type,
        tableName: order.table?.name,
        table: order.table?.slug,
        branchName: order.branch?.name,
        branch: order.branch?.slug,
        referenceNumber: order.referenceNumber.toString(),
        createdAt: order.createdAt.toISOString(),
      },
    };
    await this.notificationProducer.createNotification(notificationData);
  }

  async sendNotificationForAllBranchStaffsWhenFailedBillPrinting(order: Order) {
    // Create notification to send to staffs in the same branch
    const staffs = await this.userRepository.find({
      where: {
        role: {
          name: In([RoleEnum.Staff, RoleEnum.Chef, RoleEnum.Manager]),
        },
        branch: {
          id: order.branch?.id,
        },
      },
    });

    const frontEndUrl = await this.getFrontendUrl();

    const notificationData = staffs.map((staff) => {
      const notificationMessage = this.notificationLanguageService.format(
        NotificationMessageCode.ORDER_BILL_FAILED_PRINTING,
        { referenceNumber: order.referenceNumber.toString() },
        staff.language as string,
      );

      return {
        message: NotificationMessageCode.ORDER_BILL_FAILED_PRINTING,
        receiverId: staff.id,
        type: NotificationType.ORDER,
        receiverName: `${staff.firstName} ${staff.lastName}`,
        title: notificationMessage.title,
        body: notificationMessage.body,
        language: staff.language,
        link: `${frontEndUrl}/system/order-management?order=${order.slug}`,
        metadata: {
          order: order.slug,
          orderType: order.type,
          tableName: order.table?.name,
          table: order.table?.slug,
          branchName: order.branch?.name,
          branch: order.branch?.slug,
          referenceNumber: order.referenceNumber.toString(),
          createdAt: order.createdAt.toISOString(),
        },
      };
    });

    await this.notificationProducer.bulkCreateNotification(notificationData);
  }

  async sendNotificationForAllBranchStaffsWhenFailedChefOrderPrinting(
    order: Order,
  ) {
    // Create notification to send to staffs in the same branch
    const staffs = await this.userRepository.find({
      where: {
        role: {
          name: In([RoleEnum.Staff, RoleEnum.Chef, RoleEnum.Manager]),
        },
        branch: {
          id: order.branch?.id,
        },
      },
    });

    const frontEndUrl = await this.getFrontendUrl();

    const notificationData = staffs.map((staff) => {
      const notificationMessage = this.notificationLanguageService.format(
        NotificationMessageCode.ORDER_CHEF_ORDER_FAILED_PRINTING,
        { referenceNumber: order.referenceNumber.toString() },
        staff.language as string,
      );

      return {
        message: NotificationMessageCode.ORDER_CHEF_ORDER_FAILED_PRINTING,
        receiverId: staff.id,
        type: NotificationType.ORDER,
        receiverName: `${staff.firstName} ${staff.lastName}`,
        title: notificationMessage.title,
        body: notificationMessage.body,
        language: staff.language,
        link: `${frontEndUrl}/system/chef-order`,
        metadata: {
          order: order.slug,
          orderType: order.type,
          tableName: order.table?.name,
          table: order.table?.slug,
          branchName: order.branch?.name,
          branch: order.branch?.slug,
          referenceNumber: order.referenceNumber.toString(),
          createdAt: order.createdAt.toISOString(),
        },
      };
    });

    await this.notificationProducer.bulkCreateNotification(notificationData);
  }

  async sendNotificationForAllBranchStaffsWhenFailedLabelTicketPrinting(
    order: Order,
  ) {
    // Create notification to send to staffs in the same branch
    const staffs = await this.userRepository.find({
      where: {
        role: {
          name: In([RoleEnum.Staff, RoleEnum.Chef, RoleEnum.Manager]),
        },
        branch: {
          id: order.branch?.id,
        },
      },
    });

    const frontEndUrl = await this.getFrontendUrl();

    const notificationData = staffs.map((staff) => {
      const notificationMessage = this.notificationLanguageService.format(
        NotificationMessageCode.ORDER_LABEL_TICKET_FAILED_PRINTING,
        { referenceNumber: order.referenceNumber.toString() },
        staff.language as string,
      );

      return {
        message: NotificationMessageCode.ORDER_LABEL_TICKET_FAILED_PRINTING,
        receiverId: staff.id,
        type: NotificationType.ORDER,
        receiverName: `${staff.firstName} ${staff.lastName}`,
        title: notificationMessage.title,
        body: notificationMessage.body,
        language: staff.language,
        link: `${frontEndUrl}/system/chef-order`,
        metadata: {
          order: order.slug,
          orderType: order.type,
          tableName: order.table?.name,
          table: order.table?.slug,
          branchName: order.branch?.name,
          branch: order.branch?.slug,
          referenceNumber: order.referenceNumber.toString(),
          createdAt: order.createdAt.toISOString(),
        },
      };
    });

    await this.notificationProducer.bulkCreateNotification(notificationData);
  }

  async sendNotificationAfterCardOrderIsPaid(cardOrder: CardOrder) {
    const context = `${NotificationUtils.name}.${this.sendNotificationAfterCardOrderIsPaid.name}`;

    const customer = await this.userRepository.findOne({
      where: { id: cardOrder.customerId },
    });

    if (!customer) {
      this.logger.error(
        `Customer not found for card order ${cardOrder.slug}`,
        context,
      );
      return;
    }

    const frontEndUrl = await this.getFrontendUrl();

    const notificationMessage = this.notificationLanguageService.format(
      NotificationMessageCode.CARD_ORDER_PAID,
      {
        cardTitle: cardOrder.cardTitle,
        orderCode: cardOrder.code,
      },
      customer.language as string,
    );

    const notificationData = {
      message: NotificationMessageCode.CARD_ORDER_PAID,
      receiverId: customer.id,
      receiverName: `${customer.firstName} ${customer.lastName}`,
      type: NotificationType.CARD_ORDER,
      title: notificationMessage.title,
      body: notificationMessage.body,
      language: customer.language,
      link: `${frontEndUrl}/profile/gift-card`,
      metadata: {
        cardOrder: cardOrder.slug,
        cardOrderCode: cardOrder.code,
        cardTitle: cardOrder.cardTitle,
        totalAmount: cardOrder.totalAmount?.toString(),
        createdAt: cardOrder.createdAt?.toISOString(),
      },
    };

    await this.notificationProducer.createNotification(notificationData);
  }

  /**
   * Send a notification to a customer who has just received a voucher
   * (e.g. from a birthday or new-user campaign).
   * @param {User} receiver - The user who received the voucher
   * @param {Voucher} voucher - The received voucher
   * @param {NotificationMessageCode} messageCode - The voucher message code
   *   (VOUCHER_BIRTHDAY_RECEIVED | VOUCHER_NEW_USER_RECEIVED)
   * @param {string} [campaignSlug] - The campaign that granted the voucher
   */
  async sendNotificationVoucherReceiving(
    receiver: User,
    voucher: Voucher,
    messageCode: NotificationMessageCode,
    campaignSlug?: string,
  ) {
    const context = `${NotificationUtils.name}.${this.sendNotificationVoucherReceiving.name}`;

    if (!receiver) {
      this.logger.error(
        `Receiver not found for voucher ${voucher?.code}`,
        context,
      );
      return;
    }

    const frontEndUrl = await this.getFrontendUrl();

    const notificationMessage = this.notificationLanguageService.format(
      messageCode,
      {
        voucherTitle: voucher.title,
        voucherCode: voucher.code,
      },
      receiver.language as string,
    );

    const notificationData = {
      message: messageCode,
      receiverId: receiver.id,
      receiverName: `${receiver.firstName} ${receiver.lastName}`,
      type: NotificationType.VOUCHER,
      title: notificationMessage.title,
      body: notificationMessage.body,
      language: receiver.language,
      link: `${frontEndUrl}/profile/voucher`,
      metadata: {
        voucher: voucher.slug,
        voucherCode: voucher.code,
        voucherTitle: voucher.title,
        campaignSlug,
        createdAt: voucher.createdAt?.toISOString(),
      },
    };

    await this.notificationProducer.createNotification(notificationData);
  }
}
