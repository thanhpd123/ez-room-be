const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const FavoriteRoom = sequelize.define('FavoriteRoom', {
        favorite_id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        user_id: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        room_id: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        created_at: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW,
        },
    }, {
        tableName: 'favorite_rooms',
        timestamps: false,
        indexes: [
            {
                unique: true,
                fields: ['user_id', 'room_id'],
            },
        ],
    });

    FavoriteRoom.associate = (models) => {
        FavoriteRoom.belongsTo(models.User, {
            foreignKey: 'user_id',
            as: 'user',
        });
        FavoriteRoom.belongsTo(models.Room, {
            foreignKey: 'room_id',
            as: 'room',
        });
    };

    return FavoriteRoom;
};
